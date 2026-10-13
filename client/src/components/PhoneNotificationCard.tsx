import { useEffect, useState } from 'react';
import { BellRing, BellOff, Loader2, Smartphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { notifyUser } from '@/lib/assignments';
import {
  disablePhonePush, enablePhonePush, getPhonePushState, syncExistingPhonePush,
  type PhonePushState,
} from '@/lib/pushNotifications';

const STATE_COPY: Record<PhonePushState, string> = {
  checking: 'Đang kiểm tra thiết bị…',
  on: 'Thiết bị này đang nhận thông báo khi có nhiệm vụ, đơn từ hoặc kết quả mới.',
  off: 'Bật một lần để nhận thông báo ngay cả khi không mở HRM.',
  blocked: 'Thông báo đang bị chặn trong cài đặt trình duyệt của thiết bị.',
  unsupported: 'Trình duyệt hoặc thiết bị này chưa hỗ trợ Web Push.',
  'needs-install': 'Trên iPhone/iPad: dùng Chia sẻ → Thêm vào Màn hình chính, rồi mở HRM từ biểu tượng để bật.',
};

export function PhoneNotificationCard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [state, setState] = useState<PhonePushState>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await syncExistingPhonePush();
        const next = await getPhonePushState();
        if (alive) setState(next);
      } catch {
        if (alive) setState(await getPhonePushState());
      }
    })();
    return () => { alive = false; };
  }, [profile?.id]);

  const enable = async () => {
    setBusy(true);
    try {
      await enablePhonePush();
      setState('on');
      toast('Đã bật thông báo trên thiết bị này.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không bật được thông báo.', 'error');
      setState(await getPhonePushState());
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disablePhonePush();
      setState('off');
      toast('Đã tắt thông báo trên thiết bị này.', 'success');
    } catch {
      toast('Không tắt được thông báo. Vui lòng thử lại.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!profile) return;
    setBusy(true);
    await notifyUser(profile.id, 'Thông báo thử từ HRM', 'Thiết bị của bạn đã nhận thông báo thành công.', 'push_test');
    setBusy(false);
    toast('Đã gửi thông báo thử.', 'success');
  };

  return (
    <Card>
      <CardHeader><CardTitle>Thông báo trên điện thoại</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${state === 'on' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {state === 'on' ? <BellRing className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">{state === 'on' ? 'Đang bật trên thiết bị này' : 'Nhận thông báo kể cả khi đóng HRM'}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{STATE_COPY[state]}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {state === 'on' && <Button variant="outline" onClick={test} disabled={busy}>Gửi thử</Button>}
            {state === 'on' ? (
              <Button variant="ghost" onClick={disable} disabled={busy}><BellOff className="h-4 w-4" />Tắt</Button>
            ) : state === 'off' ? (
              <Button onClick={enable} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Bật thông báo</Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

