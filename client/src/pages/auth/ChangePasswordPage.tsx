import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ArrowRight, ArrowLeft, ShieldAlert, KeyRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { PasswordField } from '@/components/ui/PasswordField';
import { validatePassword } from '@/lib/passwordPolicy';
import { APP_NAME } from '@/lib/branding';
import { displayIdentifier } from '@/lib/identity';

/**
 * Đổi mật khẩu tự phục vụ. Luôn yêu cầu mật khẩu hiện tại.
 * Dùng cho cả hai tình huống:
 *  - Người dùng chủ động đổi mật khẩu bất kỳ lúc nào.
 *  - Bị ép đổi sau khi admin cấp / reset mật khẩu tạm (`must_change_password`).
 */
export function ChangePasswordPage() {
  const { profile, changePassword, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const forced = !!profile?.must_change_password;
  const homePath = profile && profile.role !== 'staff' ? '/admin/dashboard' : '/staff/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!oldPassword) {
      setError('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }

    const invalid = validatePassword(password);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (password === oldPassword) {
      setError('Mật khẩu mới phải khác mật khẩu hiện tại.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setLoading(true);
    const { error } = await changePassword(oldPassword, password);
    setLoading(false);

    if (error) {
      setError(error);
      toast(error, 'error');
      return;
    }

    toast('Đổi mật khẩu thành công!', 'success');
    navigate(homePath, { replace: true });
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-11 h-11 bg-indigo-600 rounded-none flex items-center justify-center">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold text-slate-800">{APP_NAME}</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-none shadow-sm p-7 fade-up">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-none bg-blue-50 flex items-center justify-center flex-shrink-0">
              <KeyRound className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="font-display text-2xl font-extrabold text-slate-900 tracking-tight">Đổi mật khẩu</h2>
          </div>
          <p className="text-sm text-slate-600 mb-6">
            {profile ? <>Tài khoản <strong className="text-slate-700">{displayIdentifier(profile.email)}</strong></> : 'Cập nhật mật khẩu cho tài khoản của bạn'}
          </p>

          {forced && (
            <div className="flex items-start gap-3 text-amber-700 bg-amber-50 border border-amber-200 rounded-none p-4 mb-5 fade-up">
              <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm leading-relaxed">
                <p className="font-semibold mb-0.5">Bạn đang dùng mật khẩu tạm</p>
                <p className="text-amber-600">
                  Hãy đặt mật khẩu riêng của bạn trước khi tiếp tục sử dụng hệ thống.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <PasswordField
              label={forced ? 'Mật khẩu tạm (admin cấp)' : 'Mật khẩu hiện tại'}
              value={oldPassword}
              onChange={setOldPassword}
              placeholder="Nhập mật khẩu hiện tại"
              autoComplete="current-password"
              hasError={!!error && !oldPassword}
            />

            <PasswordField
              label="Mật khẩu mới"
              value={password}
              onChange={setPassword}
              placeholder="Tối thiểu 8 ký tự, có chữ và số"
              autoComplete="new-password"
              showRules
            />

            <PasswordField
              label="Xác nhận mật khẩu mới"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Nhập lại mật khẩu mới"
              autoComplete="new-password"
            />

            {error && (
              <div className="flex items-center gap-2.5 text-sm text-red-600 bg-red-50 border border-red-200 rounded-none px-4 py-3 fade-up">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-indigo-600 text-white text-sm font-semibold rounded-none hover:bg-indigo-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>Cập nhật mật khẩu <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 text-center">
            {forced ? (
              <button onClick={handleSignOut} className="text-sm text-slate-600 hover:text-red-600 transition-colors">
                Đăng xuất
              </button>
            ) : (
              <button
                onClick={() => navigate(homePath)}
                className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-blue-600 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Quay lại
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
