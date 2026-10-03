import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, CircleAlert, KeyRound } from 'lucide-react';
import { PasswordField } from '@/components/ui/PasswordField';
import { APP_NAME } from '@/lib/branding';
import { completePasswordRecovery } from '@/lib/auth';
import { validatePassword } from '@/lib/passwordPolicy';
import { supabase } from '@/lib/supabase';

function hasRecoveryMarker(): boolean {
  return sessionStorage.getItem('hrm:password-recovery') === '1'
    || /(?:^|[?#&])type=recovery(?:&|$)/.test(`${window.location.search}${window.location.hash}`);
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(hasRecoveryMarker);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && active) {
        sessionStorage.setItem('hrm:password-recovery', '1');
        setReady(true);
        setChecking(false);
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setReady((current) => current && !!data.session);
      setChecking(false);
    });
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const invalid = validatePassword(password);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp. Vui lòng nhập lại.');
      return;
    }

    setLoading(true);
    const response = await completePasswordRecovery(password);
    setLoading(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    navigate('/login', { replace: true, state: { passwordReset: true } });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-ambient px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 shadow-lg shadow-indigo-600/20">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <div><p className="font-display text-lg font-bold text-slate-900">{APP_NAME}</p><p className="text-xs text-slate-500">Bảo vệ tài khoản</p></div>
        </div>

        <section className="rounded-3xl border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_-28px_rgba(15,23,42,0.28)] sm:p-8" aria-labelledby="reset-title">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><KeyRound className="h-6 w-6" /></div>
          <h1 id="reset-title" className="font-display text-2xl font-bold tracking-tight text-slate-950">Đặt mật khẩu mới</h1>

          {checking ? (
            <div className="py-10 text-center" role="status"><span className="mx-auto block h-7 w-7 animate-spin rounded-full border-2 border-indigo-100 border-t-indigo-600" /><p className="mt-3 text-sm text-slate-500">Đang kiểm tra liên kết khôi phục…</p></div>
          ) : !ready ? (
            <div className="mt-5">
              <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <div><p className="text-sm font-semibold">Liên kết không còn hiệu lực</p><p className="mt-1 text-sm leading-5">Liên kết có thể đã hết hạn hoặc đã được sử dụng. Hãy yêu cầu một liên kết mới.</p></div>
              </div>
              <Link to="/forgot-password" className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700">Yêu cầu liên kết mới</Link>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm leading-6 text-slate-500">Chọn mật khẩu riêng, khó đoán và chưa dùng cho tài khoản khác.</p>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <PasswordField label="Mật khẩu mới" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Tối thiểu 8 ký tự, có chữ và số" showRules />
                <PasswordField label="Xác nhận mật khẩu mới" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" placeholder="Nhập lại mật khẩu mới" />
                {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">{error}</div>}
                <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 disabled:opacity-60">
                  {loading ? 'Đang cập nhật…' : 'Đặt mật khẩu mới'}
                </button>
              </form>
            </>
          )}

          <div className="mt-6 border-t border-slate-100 pt-5 text-center">
            <Link to="/login" className="inline-flex min-h-11 items-center gap-2 px-2 text-sm font-semibold text-slate-600 hover:text-indigo-600"><ArrowLeft className="h-4 w-4" /> Quay lại đăng nhập</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
