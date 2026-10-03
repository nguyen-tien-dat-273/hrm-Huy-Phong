import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, AtSign, Building2, Check, KeyRound, Mail, MessageSquareText,
  Phone, ShieldCheck, UserRound,
} from 'lucide-react';
import { APP_NAME } from '@/lib/branding';
import {
  identifyPasswordRecovery, requestPasswordReset, verifyPasswordResetCode,
  type RecoveryDeliveryChannel, type RecoveryMethod,
} from '@/lib/auth';
import { validateIdentifier } from '@/lib/identity';

type Step = 'account' | 'method' | 'verify';

const STEP_INDEX: Record<Step, number> = { account: 1, method: 2, verify: 3 };

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
    setError('');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-ambient px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 shadow-lg shadow-indigo-600/20">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <div>
            <p className="font-display text-lg font-bold text-slate-900">{APP_NAME}</p>
            <p className="text-xs text-slate-500">Khôi phục quyền truy cập an toàn</p>
          </div>
        </div>

        <section className="rounded-3xl border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_-28px_rgba(15,23,42,0.28)] sm:p-8" aria-labelledby="forgot-title">
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <KeyRound className="h-6 w-6" />
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
              Bước {STEP_INDEX[step]}/3
            </span>
          </div>
          <h1 id="forgot-title" className="mt-5 font-display text-2xl font-bold tracking-tight text-slate-950">Quên mật khẩu</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {step === 'account' && 'Nhập tên đăng nhập để xác nhận đúng tài khoản cần khôi phục.'}
            {step === 'method' && 'Chọn một kênh đã xác minh trong hồ sơ để nhận mã bảo mật.'}
            {step === 'verify' && 'Nhập mã 6 chữ số vừa được gửi cho bạn.'}
          </p>

          <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Tiến trình khôi phục mật khẩu">
            {[
              { number: 1, label: 'Tài khoản' },
              { number: 2, label: 'Kênh nhận' },
              { number: 3, label: 'Xác minh' },
            ].map((item) => {
              const active = item.number <= STEP_INDEX[step];
              return (
                <li key={item.number} className="text-center">
                  <span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    {item.number < STEP_INDEX[step] ? <Check className="h-3.5 w-3.5" /> : item.number}
                  </span>
                  <span className={`mt-1 block text-[10px] font-semibold ${active ? 'text-indigo-700' : 'text-slate-400'}`}>{item.label}</span>
                </li>
              );
            })}
          </ol>

          {step === 'account' && (
            <form onSubmit={identify} className="mt-6 space-y-4">
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
                <p id="username-hint" className="mt-1.5 text-xs leading-5 text-slate-500">Đây là tên bạn dùng tại màn hình đăng nhập, không phải email hoặc số điện thoại nhận mã.</p>
              </div>
              {error && <ErrorMessage message={error} />}
              <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 disabled:opacity-60">
                {loading ? 'Đang xác nhận…' : 'Tiếp tục'}
              </button>
            </form>
          )}

          {step === 'method' && (
            <form onSubmit={sendCode} className="mt-6 space-y-4">
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
              <button type="submit" disabled={loading || !channel} className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? 'Đang gửi mã…' : 'Gửi mã xác minh'}
              </button>
              <button type="button" onClick={restart} className="flex min-h-11 w-full items-center justify-center gap-2 text-sm font-semibold text-slate-500 hover:text-indigo-600"><ArrowLeft className="h-4 w-4" />Dùng tài khoản khác</button>
            </form>
          )}

          {step === 'verify' && (
            <form onSubmit={verifyCode} className="mt-6 space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm leading-5 text-emerald-800" role="status">
                <MessageSquareText className="mr-2 inline h-4 w-4" />
                Mã đã gửi tới <strong>{sentHint}</strong> qua {channel === 'phone' ? 'SMS' : 'email'}.
              </div>
              <div>
                <label htmlFor="recovery-code" className="mb-1.5 block text-sm font-semibold text-slate-700">Mã xác minh</label>
                <input
                  id="recovery-code"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  aria-invalid={!!error}
                  className="h-14 w-full rounded-xl border border-slate-200 bg-white text-center font-mono text-2xl font-bold tracking-[0.35em] text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
                />
              </div>
              {error && <ErrorMessage message={error} />}
              <button type="submit" disabled={loading || code.length !== 6} className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? 'Đang xác minh…' : 'Xác minh và đặt mật khẩu mới'}
              </button>
              <div className="flex items-center justify-between gap-3 text-sm">
                <button type="button" onClick={() => { setStep('method'); setCode(''); setError(''); }} className="min-h-11 font-semibold text-slate-500 hover:text-indigo-600">Đổi kênh nhận</button>
                <button type="button" disabled={loading} onClick={() => void sendCode()} className="min-h-11 font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50">Gửi lại mã</button>
              </div>
            </form>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4 text-center">
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
  return <div id="recovery-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm leading-5 text-red-700">{message}</div>;
}
