import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { installNumericSelectOnFocus } from './lib/numericFocus';

installNumericSelectOnFocus();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Đăng ký service worker để app cài được lên màn hình chính và mở nhanh khi
// offline. Chỉ chạy ở bản build thật (dev có HMR, service worker gây phiền).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Bản service worker mới tiếp quản giữa chừng nghĩa là trang đang chạy code
  // của bản cũ trong khi service worker phục vụ tài nguyên của bản mới — hai
  // bên lệch nhau là nguồn của lỗi "không tải được mảnh". Tải lại đúng MỘT lần
  // để cả hai về cùng một bản.
  //
  // Chỉ tải lại khi ĐÃ có một service worker trước đó. Lần cài đầu tiên,
  // `clients.claim()` cũng bắn sự kiện này — tải lại khi ấy là bắt người dùng
  // mới chịu một cú nháy trang vô cớ, trong khi trang đang chạy đã đúng bản.
  const hadControllerAtStartup = Boolean(navigator.serviceWorker.controller);
  let reloadingForNewWorker = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtStartup || reloadingForNewWorker) return;
    reloadingForNewWorker = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Không cài được service worker cũng không sao — app vẫn chạy như web thường. */
    });
  });
}
