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
    /* Vi tri: mobile phai nam TREN thanh chon module o day man (bottom-24),
       desktop khong co thanh do nen ha xuong sat goc. Dung mot gia tri cho ca
       hai thi hoac de dong dien thoai hoac lo lung giua man desktop. */
    <div className="fixed inset-x-4 bottom-24 z-40 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[22rem] print:hidden">
      <div className="rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-slate-900/10">
        {/* Xep DOC thay vi bon thu mot hang.
            Ban cu nhet icon + hai dong chu + nut Bat + nut X vao cung mot
            hang trong the rong 384px, nen cot chu con hon trang giay - tieu
            de vo hai dong, mo ta vo ba dong, the cao gap doi can thiet. */}
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
            <BellRing className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm font-semibold leading-snug text-slate-900">
              Nhận việc mới trên điện thoại
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Báo ngay khi có nhiệm vụ, đơn từ hoặc kết quả duyệt — không phải mở web để kiểm.
            </p>
          </div>
          {/* Nut dong o goc, nho va mo: day la loi tu choi, khong phai mot
              lua chon ngang hang voi "Bat". */}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Để sau"
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nut chiem ca chieu ngang: tren dien thoai, nut nho nam canh chu la
            thu hay bam truot nhat. */}
        <button
          type="button"
          onClick={() => void enable()}
          disabled={busy}
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {busy ? 'Đang bật…' : 'Bật thông báo'}
        </button>
      </div>
    </div>
  );
}
