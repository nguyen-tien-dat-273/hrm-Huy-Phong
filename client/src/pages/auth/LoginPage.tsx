import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Building2, AtSign, Lock, Eye, EyeOff, ArrowRight, Sparkles, BarChart3, Clock3, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { validateIdentifier } from '@/lib/identity';
import { APP_NAME } from '@/lib/branding';

export function LoginPage() {
  const { signIn } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? '/';
  const resetComplete = (location.state as { passwordReset?: boolean } | null)?.passwordReset === true;

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState<'identifier' | 'password' | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const invalid = validateIdentifier(identifier);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!password) {
      setError('Vui lòng nhập mật khẩu.');
      return;
    }

    setLoading(true);
    const { error } = await signIn(identifier, password);
    if (error) {
      setError(error);
      toast(error, 'error');
      setLoading(false);
      return;
    }

    toast('Đăng nhập thành công!', 'success');
    setLoading(false);
    navigate(fromPath === '/login' ? '/' : fromPath, { replace: true });
  };

  const inputCls = (hasError: boolean) =>
    `peer w-full h-12 pl-11 pr-11 rounded-xl bg-slate-50/80 border text-sm text-slate-800 placeholder:text-slate-400 transition-all duration-200 focus:outline-none focus:ring-4 ${
      hasError
        ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
        : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100 focus:bg-white'
    }`;

  const features = [
    { icon: BarChart3, title: 'PHÂN TÍCH', desc: 'Dữ liệu hiệu suất thời gian thực' },
    { icon: Clock3, title: 'ĐIỀU PHỐI', desc: 'Nhịp độ làm việc & chấm công' },
    { icon: Users, title: 'VẬN HÀNH', desc: 'Quản trị dự án & nguồn lực' },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Left column - personnel template branding */}
      <div className="hidden lg:flex lg:w-[46%] relative overflow-hidden bg-slate-900">
        <div className="absolute inset-0 bg-grid-pattern opacity-20" />
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-indigo-600/20 blur-3xl animate-blob" />
        <div className="absolute bottom-0 left-1/4 w-72 h-72 rounded-full bg-indigo-900/30 blur-3xl animate-blob" style={{ animationDelay: '4s' }} />

        <div className="absolute inset-0 opacity-[0.06]">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="particle"
            style={{
              left: `${10 + i * 16}%`,
              width: `${6 + (i % 3) * 3}px`,
              height: `${6 + (i % 3) * 3}px`,
              animationDuration: `${8 + i * 2}s`,
              animationDelay: `${i * 1.2}s`,
            }}
          />
        ))}

        <div className="relative z-10 flex flex-col justify-between py-16 px-14 w-full">
          <div className="flex items-center gap-3 fade-up">
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex flex-col items-center justify-center gap-0.5 shadow-lg shadow-indigo-950/30">
              <div className="w-5 h-1 bg-white/30 rounded-full" />
              <div className="w-5 h-1 bg-white rounded-full" />
              <div className="w-5 h-1 bg-white/30 rounded-full" />
            </div>
            <div>
              <p className="text-xl font-bold tracking-tight text-white">HRM Huy Phong</p>
              <p className="text-xs text-slate-400 mt-0.5">Hệ thống quản lý nhân sự</p>
            </div>
          </div>

          <div className="space-y-12">
            <div className="fade-up delay-1">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-400/20 text-[10px] font-bold text-indigo-300 uppercase tracking-widest mb-6">
                Quản lý tập trung
              </div>
              <h1 className="font-display text-4xl xl:text-5xl font-bold leading-tight text-white mb-6">
                Quản trị nhịp độ<br />nhân sự & dự án
              </h1>
              <p className="text-base text-slate-400 max-w-sm leading-relaxed border-l border-slate-800 pl-6">
                Hệ thống hợp nhất chấm công, điều phối công việc và quản trị hiệu suất tập trung.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 fade-up delay-2">
              {features.map((f) => (
                <div key={f.title} className="flex items-center gap-5 group">
                  <div className="w-1 h-8 bg-slate-700 group-hover:bg-indigo-500 transition-colors" />
                  <div>
                    <p className="text-[10px] font-bold text-indigo-300 tracking-widest uppercase mb-0.5">{f.title}</p>
                    <p className="text-sm text-slate-300 font-medium">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-slate-500 fade-up delay-3">
            © {new Date().getFullYear()} {APP_NAME}. Bảo mật & tin cậy.
          </div>
        </div>
      </div>

      {/* Right column - form */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-ambient px-5 py-8 sm:px-8 sm:py-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-indigo-200/35 blur-3xl lg:hidden" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-100/50 blur-3xl lg:hidden" />
        <div className="relative w-full max-w-md rounded-3xl border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_-28px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:p-10 lg:max-w-sm lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <div className="flex items-center gap-3 mb-9 lg:hidden">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-600/20 flex flex-col items-center justify-center gap-0.5">
              <div className="w-4 h-0.5 bg-white/30 rounded-full" />
              <div className="w-4 h-0.5 bg-white rounded-full" />
              <div className="w-4 h-0.5 bg-white/30 rounded-full" />
            </div>
            <div><p className="text-lg font-bold text-slate-900">HRM Huy Phong</p><p className="text-xs text-slate-500">Không gian làm việc tập trung</p></div>
          </div>

          <div className="fade-up">
            <span className="mb-3 inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-700">Cổng nhân sự bảo mật</span>
            <h2 className="font-display text-3xl font-bold text-slate-950 mb-2 tracking-tight">Chào mừng trở lại</h2>
            <p className="text-sm leading-6 text-slate-500 mb-8">Đăng nhập để tiếp tục công việc, chấm công và theo dõi các yêu cầu của bạn.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 fade-up delay-1">
            {resetComplete && (
              <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm font-medium text-emerald-700">
                Mật khẩu đã được cập nhật. Bạn có thể đăng nhập bằng mật khẩu mới.
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="login-identifier" className="block text-xs font-bold text-slate-600 uppercase tracking-wider">Tên đăng nhập</label>
              <div className="relative">
                <AtSign className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${focused === 'identifier' ? 'text-indigo-600' : 'text-slate-400'}`} />
                <input
                  type="text"
                  id="login-identifier"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  onFocus={() => setFocused('identifier')}
                  onBlur={() => setFocused(null)}
                  placeholder="admin_huyphong"
                  className="w-full h-12 pl-10 pr-4 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 shadow-sm placeholder:text-slate-300 hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="login-password" className="block text-xs font-bold text-slate-600 uppercase tracking-wider">Mật khẩu</label>
                <Link to="/forgot-password" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline">
                  Quên mật khẩu?
                </Link>
              </div>
              <div className="relative">
                <Lock className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${focused === 'password' ? 'text-indigo-600' : 'text-slate-400'}`} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full h-12 pl-10 pr-10 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 shadow-sm placeholder:text-slate-300 hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-medium text-red-700 fade-up">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-indigo-600 text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 hover:shadow-xl transition-all active:translate-y-px disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>Đăng nhập <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </form>

          <div className="mt-7 pt-5 border-t border-slate-200/80 text-center fade-up delay-2">
            <p className="text-xs text-slate-500 leading-relaxed">
              Tài khoản được quản trị viên cấp. Nếu không đăng nhập được,<br className="hidden sm:block" /> hãy liên hệ bộ phận phụ trách nhân sự.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
