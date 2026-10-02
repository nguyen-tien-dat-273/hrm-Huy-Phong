import { supabase } from './supabase';

export type PhonePushState = 'checking' | 'on' | 'off' | 'blocked' | 'unsupported' | 'needs-install';

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function phonePushCapability(): PhonePushState {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-install';
  if (Notification.permission === 'denied') return 'blocked';
  return 'off';
}

export async function getPhonePushState(): Promise<PhonePushState> {
  const capability = phonePushCapability();
  if (capability !== 'off') return capability;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return 'off';
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', subscription.endpoint)
    .maybeSingle();
  return !error && data ? 'on' : 'off';
}

async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error('Trình duyệt không trả về khóa đăng ký thông báo.');

  const { error } = await supabase.rpc('save_my_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message);
}

export async function enablePhonePush(): Promise<void> {
  const capability = phonePushCapability();
  if (capability === 'needs-install') throw new Error('Trên iPhone/iPad, hãy thêm HRM vào Màn hình chính rồi mở ứng dụng từ biểu tượng đó.');
  if (capability === 'unsupported') throw new Error('Trình duyệt này không hỗ trợ thông báo đẩy.');
  if (capability === 'blocked') throw new Error('Thông báo đang bị chặn. Hãy mở cài đặt trình duyệt và cho phép thông báo cho trang này.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Bạn chưa cho phép nhận thông báo.');

  const configResponse = await fetch('/api/push-config');
  const config = await configResponse.json() as { publicKey?: string; error?: string };
  if (!configResponse.ok || !config.publicKey) throw new Error(config.error || 'Chưa lấy được khóa thông báo.');

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(config.publicKey),
    });
  try {
    await saveSubscription(subscription);
  } catch (error) {
    // Không để trình duyệt trông như đã bật trong khi database chưa lưu được
    // endpoint. Chỉ gỡ subscription vừa tạo; subscription cũ có thể còn dùng.
    if (!existing) await subscription.unsubscribe();
    throw error;
  }
}

export async function disablePhonePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  await subscription.unsubscribe();
}

/** Đảm bảo endpoint hiện có thuộc tài khoản vừa đăng nhập, không thuộc phiên cũ. */
export async function syncExistingPhonePush(): Promise<void> {
  if (phonePushCapability() !== 'off' || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await saveSubscription(subscription);
}
