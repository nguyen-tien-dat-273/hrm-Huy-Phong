// ============================================================================
// Gợi ý cài app lên màn hình chính.
// ----------------------------------------------------------------------------
// Chrome/Edge/Android bắn sự kiện `beforeinstallprompt` khi trang đủ điều kiện
// cài (có manifest + service worker + HTTPS). Ta giữ lại sự kiện đó và hiện một
// dải mời cài; bấm là gọi prompt gốc của trình duyệt. Người dùng bỏ qua thì
// nhớ trong localStorage để không làm phiền lại.
//
// iOS Safari không có sự kiện này (cài qua nút Chia sẻ → "Thêm vào MH chính"),
// nên dải chỉ hiện ở nơi trình duyệt thực sự cài được — không hứa hão.
// ============================================================================

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { APP_SHORT_NAME } from '@/lib/branding';

const DISMISS_KEY = 'hrm_install_dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;

    const onPrompt = (e: Event) => {
      e.preventDefault(); // chặn thanh mời mặc định để tự hiện dải riêng
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => { setVisible(false); setDeferred(null); };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setVisible(false);
    setDeferred(null);
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-6 sm:max-w-sm z-40 print:hidden">
      <div className="flex items-center gap-3 rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 px-4 py-3">
        <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
          <Download className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 leading-tight">Cài {APP_SHORT_NAME} lên máy</p>
          <p className="text-xs text-slate-500 leading-tight mt-0.5">Mở nhanh, chấm công tiện như một ứng dụng.</p>
        </div>
        <button
          type="button"
          onClick={install}
          className="min-h-11 flex-shrink-0 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Cài đặt
        </button>
        <button type="button" onClick={dismiss} aria-label="Đóng" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
