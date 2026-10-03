import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, AtSign, Building2, KeyRound, Mail, MessageSquareText, Phone } from 'lucide-react';
import { APP_NAME } from '@/lib/branding';
import { normalizeRecoveryPhone, requestPasswordReset, verifyPasswordResetCode, type RecoveryChannel } from '@/lib/auth';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [channel, setChannel] = useState<RecoveryChannel>('email');
  const [recipient, setRecipient] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const value = recipient.trim();
    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Nhập đúng email đã đăng ký trong hồ sơ cá nhân.');
      return;
    }
    if (channel === 'phone' && !normalizeRecoveryPhone(value)) {
      setError('Số điện thoại không hợp lệ. Ví dụ: 0862577958.');
      return;
    }
    setLoading(true);
    const response = await requestPasswordReset(channel, value);
    setLoading(false);
    if (response.error) { setError(response.error); return; }
    setStep('verify');
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Mã xác minh gồm 6 chữ số.');
      return;
    }
    setLoading(true);
    const response = await verifyPasswordResetCode(channel, recipient, code);
    setLoading(false);
    if (response.error) { setError(response.error); return; }
    navigate('/reset-password', { replace: true });
  };

  const selectChannel = (next: RecoveryChannel) => {
    setChannel(next);
    setRecipient('');
    setCode('');
    setStep('request');
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
            <p className="text-xs text-slate-500">Khôi phục quyền truy cập</p>
          </div>
        </div>

        <section className="rounded-3xl border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_-28px_rgba(15,23,42,0.28)] sm:p-8" aria-labelledby="forgot-title">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 id="forgot-title" className="font-display text-2xl font-bold tracking-tight text-slate-950">Quên mật khẩu</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Nhận mã 6 chữ số qua thông tin đã đăng ký và xác minh trong hồ sơ cá nhân.</p>

          <div className="mt-5 grid grid-cols-2 gap-2" role="group" aria-label="Chọn cách nhận mã">
            <button type="button" onClick={() => selectChannel('email')} aria-pressed={channel === 'email'} className={`min-h-12 rounded-xl border px-3 text-sm font-semibold ${channel === 'email' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <Mail className="mr-2 inline h-4 w-4" />Qua email
            </button>
            <button type="button" onClick={() => selectChannel('phone')} aria-pressed={channel === 'phone'} className={`min-h-12 rounded-xl border px-3 text-sm font-semibold ${channel === 'phone' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <Phone className="mr-2 inline h-4 w-4" />Qua SMS
            </button>
          </div>

          {step === 'request' ? (
            <form onSubmit={sendCode} className="mt-5 space-y-4">
              <div>
                <label htmlFor="recovery-recipient" className="mb-1.5 block text-sm font-semibold text-slate-700">{channel === 'email' ? 'Email đã đăng ký' : 'Số điện thoại đã đăng ký'}</label>
                <div className="relative">
                  {channel === 'email' ? <AtSign className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /> : <Phone className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />}
                  <input
                    id="recovery-recipient"
                    autoFocus
                    type={channel === 'email' ? 'email' : 'tel'}
                    inputMode={channel === 'email' ? 'email' : 'tel'}
                    autoComplete={channel === 'email' ? 'email' : 'tel'}
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    placeholder={channel === 'email' ? 'email@congty.vn' : '0862 577 958'}
                    aria-invalid={!!error}
                    aria-describedby={error ? 'recovery-error' : undefined}
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
                  />
                </div>
              </div>
              {error && <div id="recovery-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">{error}</div>}
              <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 disabled:opacity-60">
                {loading ? 'Đang gửi mã…' : 'Gửi mã xác minh'}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="mt-5 space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm leading-5 text-emerald-700" role="status">
                <MessageSquareText className="mr-2 inline h-4 w-4" />Nếu thông tin đã được xác minh, mã sẽ được gửi tới <strong>{recipient}</strong>.
              </div>
              <div>
                <label htmlFor="recovery-code" className="mb-1.5 block text-sm font-semibold text-slate-700">Mã xác minh</label>
                <input id="recovery-code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" aria-invalid={!!error} className="h-14 w-full rounded-xl border border-slate-200 bg-white text-center font-mono text-2xl font-bold tracking-[0.35em] text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100" />
              </div>
              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">{error}</div>}
              <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{loading ? 'Đang xác minh…' : 'Xác minh mã'}</button>
              <div className="flex items-center justify-between gap-3 text-sm">
                <button type="button" onClick={() => { setStep('request'); setCode(''); setError(''); }} className="min-h-11 font-semibold text-slate-500 hover:text-indigo-600">Đổi thông tin</button>
                <button type="button" onClick={() => void requestPasswordReset(channel, recipient)} className="min-h-11 font-semibold text-indigo-600 hover:text-indigo-700">Gửi lại mã</button>
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
