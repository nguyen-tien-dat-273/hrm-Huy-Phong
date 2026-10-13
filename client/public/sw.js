// ============================================================================
// Service worker cho HRM Huy Phong.
// ----------------------------------------------------------------------------
// Nguyên tắc số một của app tiền lương: KHÔNG BAO GIỜ phục vụ số liệu cũ.
// Một phiếu lương hay bảng chấm công lấy từ cache là con số sai trông y như
// con số đúng — không có cách nào người dùng tự nhận ra.
//
// Vì vậy service worker này chỉ đụng tới VỎ ỨNG DỤNG:
//   - Tài nguyên build (/assets/...) có tên gắn mã băm, đổi nội dung là đổi
//     tên, nên cache vĩnh viễn được mà không sợ cũ.
//   - Điều hướng trang thì ưu tiên mạng, chỉ rơi về cache khi mất mạng — để
//     app mở được offline thay vì hiện màn hình khủng long.
//
// KHÔNG chạm tới:
//   - Bất kỳ request nào khác origin (Supabase, API) — để nguyên cho trình
//     duyệt xử lý, nghĩa là luôn đi mạng thật.
//   - Request không phải GET.
//   - /api/... của chính origin này.
// ============================================================================

// `__BUILD_ID__` duoc thay bang dau thoi gian build (xem vite.config.ts).
//
// Day moi la thu lam cho co che tu tai lai hoat dong. Truoc day VERSION la
// mot chuoi co dinh, nen moi lan deploy trinh duyet tai ve mot file sw.js
// GIONG HET byte - no coi nhu khong co gi moi, khong cai worker moi, khong
// ban `controllerchange`, va app dang mo tren may nguoi dung chay mai ban cu
// cho toi khi ho tu bam tai lai.
const VERSION = 'hrm-__BUILD_ID__';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

// Đủ để app khởi động được khi offline. Tài nguyên có mã băm được cache dần
// lúc chạy, không liệt kê ở đây vì tên đổi sau mỗi lần build.
const SHELL_URLS = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      // Một URL hỏng không được phép chặn cả lần cài.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Cho phép trang chủ động yêu cầu bản mới tiếp quản ngay. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Web Push: payload chỉ chứa nội dung thông báo đã được API xác thực. Luôn
// hiện thông báo cho người dùng; trình duyệt không cho phép nhận push "âm".
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }

  const title = payload.title || 'HRM Huy Phong';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || 'Bạn có thông báo mới.',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag,
    data: payload.data || { url: '/' },
    vibrate: [150, 80, 150],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ('navigate' in client) await client.navigate(target);
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Khác origin: Supabase, ảnh ngoài, bất cứ thứ gì. Không đụng vào.
  if (url.origin !== self.location.origin) return;

  // Hàm serverless của chính app — dữ liệu thật, luôn đi mạng.
  if (url.pathname.startsWith('/api/')) return;

  // Tài nguyên build có mã băm trong tên: nội dung đổi thì tên đổi, nên phục
  // vụ từ cache là an toàn tuyệt đối và nhanh hơn hẳn.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Điều hướng trang: ưu tiên mạng để luôn nhận bản deploy mới nhất, mất mạng
  // mới rơi về vỏ đã lưu.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() =>
          caches.match('/').then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  // Còn lại (icon, manifest…): thử mạng trước, hỏng thì lấy cache.
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((hit) => hit || Response.error())),
  );
});
