// Quiet Command Center: onboarding screen with ink navigation mood, ivory surface, and Copper Signal actions.
import { useState } from 'react';
import { Building2, Database, KeyRound, CheckCircle2, ArrowRight, ShieldCheck } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { saveSupabaseConfig, getSupabaseConfig } from '@/lib/supabaseConfig';

const LOGO_URL = '/manus-storage/hrm-copper-signal-logo_2f21e543.png';
const BACKDROP_URL = '/manus-storage/hrm-command-center-background_78a59e90.png';

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`relative inline-flex ${small ? 'h-10 w-10' : 'h-11 w-11'} items-end justify-center gap-0.5`} aria-label="Huy Phong Wine">
      <img src={LOGO_URL} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} className="absolute inset-0 h-full w-full object-contain" />
      <i className="h-[68%] w-[22%] bg-[#102A43]" /><i className="h-full w-[22%] bg-[#C8754A]" /><i className="h-[82%] w-[22%] bg-[#102A43]" />
    </span>
  );
}

export function SetupPage() {
  const { toast } = useToast();
  const existing = getSupabaseConfig();
  const [url, setUrl] = useState(existing?.url || '');
  const [anonKey, setAnonKey] = useState(existing?.anonKey || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (!url.trim() || !anonKey.trim()) {
      toast('Vui lòng nhập đầy đủ URL và anon key.', 'warning');
      setLoading(false);
      return;
    }
    saveSupabaseConfig({ url: url.trim(), anonKey: anonKey.trim() });
    toast('Đã lưu cấu hình. Vui lòng tải lại trang.', 'success');
    setLoading(false);
    setTimeout(() => window.location.reload(), 600);
  };

  return (
    <div className="min-h-screen bg-[#102A43] text-[#F7F3ED] lg:grid lg:grid-cols-[minmax(300px,0.82fr)_minmax(520px,1.18fr)]">
      <aside
        className="relative hidden overflow-hidden border-r border-white/10 bg-[#102A43] lg:flex lg:flex-col lg:justify-between lg:p-12"
        style={{ backgroundImage: `linear-gradient(180deg, rgba(16,42,67,.16), rgba(16,42,67,.96)), url(${BACKDROP_URL})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      >
        <div className="relative z-10 flex items-center gap-3">
          <BrandMark />
          <div>
            <div className="font-[Space_Grotesk] text-lg font-semibold tracking-tight">Huy Phong Wine</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#C8754A]">People / Time / Work</div>
          </div>
        </div>
        <div className="relative z-10 max-w-sm pb-8">
          <div className="mb-5 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C8754A]"><span className="h-px w-9 bg-[#C8754A]" /> System setup / 01</div>
          <h1 className="font-[Space_Grotesk] text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-[#F7F3ED]">Đưa trung tâm điều hành vào nhịp làm việc.</h1>
          <p className="mt-5 max-w-xs text-sm leading-6 text-[#C6D3DE]">Kết nối workspace với Supabase để dữ liệu nhân sự, chấm công và công việc đồng bộ trong một không gian duy nhất.</p>
          <div className="mt-8 flex items-center gap-3 text-xs text-[#C6D3DE]"><ShieldCheck className="h-4 w-4 text-[#C8754A]" /> Chỉ dùng publishable / anon key ở phía trình duyệt</div>
        </div>
        <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#8EA5B7]"><span>HRM / ONLINE</span><span>v1.0</span></div>
      </aside>

      <main className="flex min-h-screen items-center bg-[#F7F3ED] px-6 py-10 text-[#102A43] sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-xl">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark small />
            <div><div className="font-[Space_Grotesk] text-lg font-semibold">Huy Phong Wine</div><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#C8754A]">System setup / 01</div></div>
          </div>
          <div className="mb-8 flex items-end justify-between gap-6">
            <div>
              <div className="mb-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C8754A]"><span className="h-px w-8 bg-[#C8754A]" /> Connection</div>
              <h2 className="font-[Space_Grotesk] text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Kết nối Supabase</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-[#66798A]">Nhập thông tin API công khai để đồng bộ dữ liệu trên mọi máy chủ.</p>
            </div>
            <div className="hidden rounded-full border border-[#D7DED9] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#66798A] sm:block">Required</div>
          </div>

          <form onSubmit={handleSubmit} className="border-t border-[#D7DED9] pt-6">
            <div className="space-y-7">
              <label className="block">
                <span className="mb-2 flex items-center gap-2 font-[Space_Grotesk] text-sm font-semibold"><Building2 className="h-4 w-4 text-[#C8754A]" /> Supabase URL</span>
                <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://YOUR_PROJECT_REF.supabase.co" className="h-12 w-full border-b border-[#B9C5CC] bg-transparent px-0 text-sm text-[#102A43] outline-none transition-colors placeholder:text-[#9AA9B3] focus:border-[#C8754A]" />
                <span className="mt-2 block font-mono text-[10px] uppercase tracking-[0.12em] text-[#8A9AA5]">Project Settings / API / Project URL</span>
              </label>
              <label className="block">
                <span className="mb-2 flex items-center gap-2 font-[Space_Grotesk] text-sm font-semibold"><KeyRound className="h-4 w-4 text-[#C8754A]" /> Publishable / Anon Key</span>
                <input type="password" value={anonKey} onChange={(e) => setAnonKey(e.target.value)} placeholder="sb_publishable_... (hoac eyJhbGci... neu con dung key cu)" className="h-12 w-full border-b border-[#B9C5CC] bg-transparent px-0 text-sm text-[#102A43] outline-none transition-colors placeholder:text-[#9AA9B3] focus:border-[#C8754A]" />
                <span className="mt-2 block font-mono text-[10px] uppercase tracking-[0.12em] text-[#8A9AA5]">Project Settings / API / Publishable key</span>
              </label>
            </div>
            <button type="submit" disabled={loading} className="mt-9 flex h-12 w-full items-center justify-center gap-2 bg-[#C8754A] px-5 font-[Space_Grotesk] text-sm font-semibold text-white shadow-[0_12px_24px_rgba(200,117,74,.2)] transition-all duration-200 hover:bg-[#B9643B] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <>Lưu cấu hình <ArrowRight className="h-4 w-4" /></>}
            </button>
            {existing && <div className="mt-5 flex items-center gap-2 border border-[#C9DDD2] bg-[#EEF6F0] px-3 py-2.5 text-xs text-[#3D765A]"><CheckCircle2 className="h-4 w-4 flex-shrink-0" /> Đã có cấu hình. Thay đổi áp dụng sau khi tải lại trang.</div>}
          </form>
          <p className="mt-8 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#8A9AA5]"><Database className="h-3.5 w-3.5" /> Không đặt service-role key trong trình duyệt</p>
        </div>
      </main>
    </div>
  );
}
