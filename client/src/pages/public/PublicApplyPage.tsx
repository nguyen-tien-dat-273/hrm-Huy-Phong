// ============================================================================
// RC2.5 — Trang ứng tuyển công khai.
// ----------------------------------------------------------------------------
// Đây là trang DUY NHẤT không cần đăng nhập, tức là bề mặt duy nhất người lạ
// chạm được. Mọi kiểm tra thật nằm ở database (hàm `submit_public_application`);
// những gì ở đây chỉ để người dùng thật đỡ mất công, không phải hàng rào.
//
// Hai lớp chặn bot đặt ở client vì chúng chỉ có tác dụng với bot ngây thơ, và
// bot ngây thơ chiếm đa số spam form tuyển dụng:
//
//   - Ô mồi (honeypot): một ô ẩn mà người thật không bao giờ thấy để điền.
//     Bot tự động điền mọi input sẽ lộ ngay.
//   - Thời gian tối thiểu: người thật cần ít nhất vài giây để đọc và gõ. Gửi
//     sau chưa đầy 3 giây gần như chắc chắn là script.
//
// Cố ý KHÔNG tự dựng CAPTCHA: làm nửa vời thì vừa cản người thật vừa không cản
// được bot nghiêm túc. Nếu spam thành vấn đề thật, nên gắn một dịch vụ chuyên
// dụng thay vì tự chế.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Send, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { supabase } from '@/lib/supabase';
import { APP_NAME } from '@/lib/branding';

/** Người thật không gửi nổi form trong ngần này giây. */
const MIN_SECONDS_ON_FORM = 3;

export function PublicApplyPage() {
  const { code = '' } = useParams();
  const openedAt = useRef(Date.now());

  const [posting, setPosting] = useState<{ title: string; is_open: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ full_name: '', email: '', phone: '', note: '' });
  // Ô mồi: người thật không thấy nên luôn rỗng.
  const [trap, setTrap] = useState('');

  useEffect(() => {
    void (async () => {
      if (!supabase || !code) { setLoading(false); return; }
      const { data } = await supabase.rpc('public_job_posting', { p_code: code });
      const row = Array.isArray(data) ? data[0] : data;
      setPosting(row ?? null);
      setLoading(false);
    })();
  }, [code]);

  const submit = async () => {
    setError('');

    if (trap) {
      // Không nói thật lý do: bot đọc được thông báo sẽ biết đường lách.
      setError('Không gửi được hồ sơ. Vui lòng thử lại.');
      return;
    }
    if ((Date.now() - openedAt.current) / 1000 < MIN_SECONDS_ON_FORM) {
      setError('Vui lòng kiểm tra lại thông tin rồi gửi.');
      return;
    }
    if (!supabase) return;

    setBusy(true);
    const { error: rpcError } = await supabase.rpc('submit_public_application', {
      p_code: code,
      p_full_name: form.full_name,
      p_email: form.email,
      p_phone: form.phone,
      p_note: form.note,
    });
    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSent(true);
  };

  if (loading) {
    return <Shell><p className="py-16 text-center text-sm text-slate-400">Đang tải…</p></Shell>;
  }

  if (!posting) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <TriangleAlert className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-3 text-lg font-bold text-slate-800">Không tìm thấy tin tuyển dụng</h1>
          <p className="mt-1 text-sm text-slate-500">Đường dẫn có thể đã hết hạn hoặc bị gõ sai.</p>
        </div>
      </Shell>
    );
  }

  if (sent) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <h1 className="mt-3 text-lg font-bold text-slate-800">Đã nhận hồ sơ của bạn</h1>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
            Cảm ơn bạn đã ứng tuyển vị trí <strong>{posting.title}</strong>. Bộ phận nhân sự sẽ
            liên hệ nếu hồ sơ phù hợp.
          </p>
        </div>
      </Shell>
    );
  }

  if (!posting.is_open) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <TriangleAlert className="mx-auto h-10 w-10 text-slate-400" />
          <h1 className="mt-3 text-lg font-bold text-slate-800">{posting.title}</h1>
          <p className="mt-1 text-sm text-slate-500">Vị trí này đã ngừng nhận hồ sơ.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-5 py-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Ứng tuyển</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{posting.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Điền thông tin bên dưới. Chúng tôi sẽ liên hệ qua email bạn cung cấp.
          </p>
        </div>

        <Input label="Họ và tên" value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Email" type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Số điện thoại" inputMode="tel" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <Textarea label="Giới thiệu ngắn về bạn" value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })} />

        {/* Ô mồi. `aria-hidden` + `tabIndex={-1}` để trình đọc màn hình và phím
            Tab bỏ qua — người khiếm thị không bị mắc bẫy. */}
        <div className="absolute left-[-9999px]" aria-hidden="true">
          <label htmlFor="company-website">Để trống ô này</label>
          <input id="company-website" tabIndex={-1} autoComplete="off"
            value={trap} onChange={(e) => setTrap(e.target.value)} />
        </div>

        {error && (
          <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            {error}
          </p>
        )}

        <Button theme="admin" className="w-full" onClick={() => void submit()} disabled={busy}>
          <Send className="h-4 w-4" /> {busy ? 'Đang gửi…' : 'Gửi hồ sơ ứng tuyển'}
        </Button>

        <p className="text-center text-xs leading-relaxed text-slate-400">
          Bằng việc gửi hồ sơ, bạn đồng ý để {APP_NAME} lưu trữ và xử lý thông tin trên cho mục
          đích tuyển dụng.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="relative mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white px-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
