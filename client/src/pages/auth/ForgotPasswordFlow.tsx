import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, AtSign, Building2, Check, CircleAlert, Clock3, KeyRound, LoaderCircle,
  LockKeyhole, Mail, MessageSquareText, Phone, ShieldCheck, UserRound,
} from 'lucide-react';
import { APP_NAME } from '@/lib/branding';
import {
  identifyPasswordRecovery, requestPasswordReset, verifyPasswordResetCode,
  type RecoveryDeliveryChannel, type RecoveryMethod,
} from '@/lib/auth';
import { validateIdentifier } from '@/lib/identity';

type Step = 'account' | 'method' | 'verify';

const STEP_INDEX: Record<Step, number> = { account: 1, method: 2, verify: 3 };
const STEP_COPY: Record<Step, { eyebrow: string; title: string; description: string }> = {
  account: {
    eyebrow: 'Bước 1 · Xác định tài khoản',
    title: 'Tìm tài khoản của bạn',
    description: 'Nhập đúng tên bạn vẫn dùng để đăng nhập hệ thống.',
  },
  method: {
    eyebrow: 'Bước 2 · Chọn kênh bảo mật',
    title: 'Bạn muốn nhận mã ở đâu?',
    description: 'Chỉ những kênh đã xác minh trong hồ sơ mới được hiển thị.',
  },
  verify: {
    eyebrow: 'Bước 3 · Xác minh danh tính',
    title: 'Nhập mã xác minh',
    description: 'Kiểm tra tin nhắn hoặc hộp thư rồi nhập mã gồm 6 chữ số.',
  },
};

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('account');
  const [username, setUsername] = useState('');
  const [methods, setMethods] = useState<RecoveryMethod[]>([]);
  const [channel, setChannel] = useState<RecoveryDeliveryChannel | null>(null);
  const [sentHint, setSentHint] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn > 0]);

  const identify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const invalid = validateIdentifier(username);
    if (invalid) { setError(invalid); return; }

    setLoading(true);
    const response = await identifyPasswordRecovery(username);
    setLoading(false);
    if (response.error || response.methods.length === 0) {
      setError(response.error ?? 'Tài khoản chưa có kênh khôi phục đã xác minh.');
      return;
    }
    setMethods(response.methods);
    setChannel(response.methods.length === 1 ? response.methods[0].channel : null);
    setStep('method');
  };

  const sendCode = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setError('');
    if (!channel) { setError('Chọn email hoặc SMS để nhận mã xác minh.'); return; }

    setLoading(true);
    const response = await requestPasswordReset(username, channel);
    setLoading(false);
    if (response.error) { setError(response.error); return; }
    setSentHint(response.hint ?? methods.find((method) => method.channel === channel)?.hint ?? 'kênh đã chọn');
    setCode('');
    setResendIn(30);
    setStep('verify');
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!channel) { setStep('method'); return; }
    if (!/^\d{6}$/.test(code)) { setError('Mã xác minh gồm 6 chữ số.'); return; }

    setLoading(true);
    const response = await verifyPasswordResetCode(username, channel, code);
    setLoading(false);
    if (response.error) { setError(response.error); return; }
    navigate('/reset-password', { replace: true });
  };

  const restart = () => {
    setStep('account');
    setMethods([]);
    setChannel(null);
    setSentHint('');
    setCode('');
    setResendIn(0);
    setError('');
  };

  const copy = STEP_COPY[step];

  return (
    <main className="flex min-h-screen items-center justify-center bg-ambient px-4 py-6 sm:px-6 sm:py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_30px_90px_-34px_rgba(15,23,42,0.35)] lg:grid-cols-[0.88fr_1.12fr]">
        <aside className="relative hidden overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 p-10 text-white lg:flex lg:flex-col">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-indigo-400/20 blur-3xl" />
          <div className="absolute -bottom-24 -left-20 h-72 w-72 rounded-full bg-blue-400/10 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
              <Building2 className="h-6 w-6" />
            </span>
            <div>
              <p className="font-display text-lg font-bold">{APP_NAME}</p>
              <p className="text-xs text-indigo-200">Hệ thống quản lý nhân sự</p>
            </div>
          </div>

          <div className="relative my-auto py-12">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <LockKeyhole className="h-7 w-7 text-indigo-200" />
            </span>
            <h2 className="mt-6 max-w-sm font-display text-3xl font-bold leading-tight">Lấy lại quyền truy cập an toàn</h2>
            <p className="mt-3 max-w-sm text-sm leading-6 text-indigo-100/75">
              Hệ thống chỉ gửi mã tới email hoặc số điện thoại đã được xác minh trong hồ sơ của bạn.
            </p>
            <div className="mt-8 space-y-4">
              <SecurityPoint icon={<ShieldCheck className="h-4 w-4" />} text="Thông tin liên hệ luôn được che bớt" />
              <SecurityPoint icon={<KeyRound className="h-4 w-4" />} text="Mỗi mã chỉ dùng cho một lần xác minh" />
              <SecurityPoint icon={<Clock3 className="h-4 w-4" />} text="Có thể gửi lại mã nếu chưa nhận được" />
            </div>
          </div>

          <p className="relative text-xs leading-5 text-indigo-200/70">Không chia sẻ mã xác minh với bất kỳ ai, kể cả người tự xưng là quản trị viên.</p>
        </aside>

        <section className="bg-white px-5 py-6 sm:px-10 sm:py-9 lg:px-12 lg:py-10" aria-labelledby="forgot-title">
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <p className="font-display text-base font-bold text-slate-900">{APP_NAME}</p>
              <p className="text-[11px] text-slate-500">Khôi phục quyền truy cập an toàn</p>
            </div>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
              <KeyRound className="h-6 w-6" />
            </div>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 ring-1 ring-indigo-100">
              Bước {STEP_INDEX[step]}/3
            </span>
          </div>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-600">{copy.eyebrow}</p>
          <h1 id="forgot-title" className="mt-1.5 font-display text-2xl font-bold tracking-tight text-slate-950 sm:text-[1.7rem]">{copy.title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{copy.description}</p>

          <ol className="mt-6 flex items-start" aria-label="Tiến trình khôi phục mật khẩu">
            {[
              { number: 1, label: 'Tài khoản' },
              { number: 2, label: 'Kênh nhận' },
              { number: 3, label: 'Xác minh' },
            ].map((item) => {
              const active = item.number <= STEP_INDEX[step];
              return (
                <li key={item.number} className="relative flex-1 text-center after:absolute after:left-[calc(50%+18px)] after:top-3.5 after:h-px after:w-[calc(100%-36px)] after:bg-slate-200 last:after:hidden">
                  <span className={`relative z-10 mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-4 ring-white ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    {item.number < STEP_INDEX[step] ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : item.number}
                  </span>
                  <span className={`mt-1 block text-[10px] font-semibold ${active ? 'text-indigo-700' : 'text-slate-400'}`}>{item.label}</span>
                </li>
              );
            })}
          </ol>

          {step === 'account' && (
            <form onSubmit={identify} className="mt-7 space-y-5">
              <div>
                <label htmlFor="recovery-username" className="mb-1.5 block text-sm font-semibold text-slate-700">Tên đăng nhập</label>
                <div className="relative">
                  <UserRound className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="recovery-username"
                    autoFocus
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="VD: nguyenvana"
                    aria-invalid={!!error}
                    aria-describedby={error ? 'recovery-error' : 'username-hint'}
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
                  />
                </div>
                <p id="username-hint" className="mt-1.5 text-xs leading-5 text-slate-500">Không nhập email hoặc số điện thoại nhận mã ở bước này.</p>
              </div>
              {error && <ErrorMessage message={error} />}
              <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 disabled:opacity-60">
                {loading ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Đang tìm tài khoản…</> : 'Xác nhận tài khoản'}
              </button>
            </form>
          )}

          {step === 'method' && (
            <form onSubmit={sendCode} className="mt-7 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                <p className="text-xs font-medium text-slate-500">Tài khoản cần khôi phục</p>
                <p className="mt-0.5 flex items-center gap-2 text-sm font-bold text-slate-800"><AtSign className="h-4 w-4 text-indigo-500" />{username}</p>
              </div>
              <div className="space-y-2" role="radiogroup" aria-label="Chọn kênh nhận mã">
                {methods.map((method) => {
                  const selected = channel === method.channel;
                  return (
                    <button
                      key={method.channel}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => { setChannel(method.channel); setError(''); }}
                      className={`flex min-h-16 w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition ${selected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'}`}
                    >
                      <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 shadow-sm'}`}>
                        {method.channel === 'email' ? <Mail className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-slate-800">{method.channel === 'email' ? 'Nhận mã qua email' : 'Nhận mã qua SMS'}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{method.hint}</span>
                      </span>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300'}`}>
                        {selected && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />Thông tin liên hệ được che để bảo vệ tài khoản. Chỉ các kênh đã xác minh mới xuất hiện.</p>
              {error && <ErrorMessage message={error} />}
              <button type="submit" disabled={loading || !channel} className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-600/15 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:shadow-none disabled:opacity-50">
                {loading ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Đang gửi mã…</> : `Gửi mã qua ${channel === 'phone' ? 'SMS' : channel === 'email' ? 'email' : 'kênh đã chọn'}`}
              </button>
              <button type="button" onClick={restart} className="flex min-h-11 w-full items-center justify-center gap-2 text-sm font-semibold text-slate-500 hover:text-indigo-600"><ArrowLeft className="h-4 w-4" />Dùng tài khoản khác</button>
            </form>
          )}

          {step === 'verify' && (
            <form onSubmit={verifyCode} className="mt-7 space-y-5">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm leading-5 text-emerald-800" role="status">
                <MessageSquareText className="mr-2 inline h-4 w-4" />
                Mã đã gửi tới <strong>{sentHint}</strong> qua {channel === 'phone' ? 'SMS' : 'email'}.
              </div>
              <div>
                <label htmlFor="recovery-code" className="mb-2 block text-sm font-semibold text-slate-700">Mã gồm 6 chữ số</label>
                <div className="group relative grid grid-cols-6 gap-2">
                  <input
                    id="recovery-code"
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    aria-invalid={!!error}
                    aria-label="Mã xác minh gồm 6 chữ số"
                    className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
                  />
                  {Array.from({ length: 6 }, (_, index) => (
                    <span key={index} aria-hidden="true" className={`flex aspect-square items-center justify-center rounded-xl border font-mono text-xl font-bold shadow-sm transition group-focus-within:ring-2 group-focus-within:ring-indigo-100 ${code[index] ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-300'} ${index === code.length ? 'group-focus-within:border-indigo-500' : ''}`}>
                      {code[index] || '·'}
                    </span>
                  ))}
                </div>
              </div>
              {error && <ErrorMessage message={error} />}
              <button type="submit" disabled={loading || code.length !== 6} className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Đang xác minh…</> : 'Tiếp tục đặt mật khẩu'}
              </button>
              <div className="flex items-center justify-between gap-3 text-sm">
                <button type="button" onClick={() => { setStep('method'); setCode(''); setError(''); }} className="min-h-11 font-semibold text-slate-500 hover:text-indigo-600">Đổi kênh nhận</button>
                <button type="button" disabled={loading || resendIn > 0} onClick={() => void sendCode()} className="min-h-11 font-semibold text-indigo-600 hover:text-indigo-700 disabled:text-slate-400 disabled:opacity-70">
                  {resendIn > 0 ? `Gửi lại sau ${resendIn}s` : 'Gửi lại mã'}
                </button>
              </div>
            </form>
          )}

          <div className="mt-6 border-t border-slate-100 pt-4 text-center">
            <Link to="/login" className="inline-flex min-h-11 items-center gap-2 px-2 text-sm font-semibold text-slate-600 hover:text-indigo-600">
              <ArrowLeft className="h-4 w-4" /> Quay lại đăng nhập
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div id="recovery-error" role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm leading-5 text-red-700">
      <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SecurityPoint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-indigo-50/90">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/10 text-indigo-200 ring-1 ring-white/10">{icon}</span>
      <span>{text}</span>
    </div>
  );
}
