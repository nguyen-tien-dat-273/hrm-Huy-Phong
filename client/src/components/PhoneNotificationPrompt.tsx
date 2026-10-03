import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { enablePhonePush, getPhonePushState } from '@/lib/pushNotifications';

const DISMISS_KEY = 'hrm_phone_push_prompt_dismissed_v1';

export function PhoneNotificationPrompt() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile || localStorage.getItem(DISMISS_KEY)) {
      setVisible(false);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void getPhonePushState()
        .then((state) => { if (alive) setVisible(state === 'off'); })
        .catch(() => { if (alive) setVisible(false); });
    }, 1200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [profile?.id]);

  const enable = async () => {
    setBusy(true);
    try {
      await enablePhonePush();
      setVisible(false);
      toast('Đã bật thông báo trên điện thoại.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không bật được thông báo.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-24 inset-x-4 z-40 sm:inset-x-auto sm:right-6 sm:max-w-sm print:hidden">
      <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-2xl ring-1 ring-slate-900/10">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight text-slate-800">Nhận việc mới trên điện thoại</p>
          <p className="mt-0.5 text-xs leading-tight text-slate-500">Thông báo ngay khi có nhiệm vụ, đơn từ hoặc kết quả duyệt.</p>
        </div>
        <button
          type="button"
          onClick={() => void enable()}
          disabled={busy}
          className="min-h-11 shrink-0 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {busy ? 'Đang bật…' : 'Bật'}
        </button>
        <button type="button" onClick={dismiss} aria-label="Để sau" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
