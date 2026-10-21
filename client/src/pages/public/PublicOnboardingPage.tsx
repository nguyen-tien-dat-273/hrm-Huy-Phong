// Trang nhân viên mới tự khai báo hồ sơ qua link. Không cần đăng nhập; mọi kiểm
// tra thật nằm ở hàm `submit_onboarding_profile` trong database. Ô mồi và thời
// gian tối thiểu chỉ để cản bot ngây thơ, giống trang ứng tuyển công khai.

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Send, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { supabase } from '@/lib/supabase';
import { APP_NAME } from '@/lib/branding';

const MIN_SECONDS_ON_FORM = 5;

const EMPTY = {
  full_name: '', email: '', phone: '', date_of_birth: '', gender: '',
  id_number: '', tax_code: '', bank_name: '', bank_account: '',
  hometown: '', permanent_address: '', current_address: '',
  education_level: '', school_name: '', major: '', graduation_year: '',
  emergency_contact: '', note: '',
};

export function PublicOnboardingPage() {
  const { code = '' } = useParams();
  const openedAt = useRef(Date.now());
  const [link, setLink] = useState<{ label: string; is_open: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [trap, setTrap] = useState('');
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  useEffect(() => {
    void (async () => {
      if (!supabase || !code) { setLoading(false); return; }
      const { data } = await supabase.rpc('public_onboarding_link', { p_code: code });
      const row = Array.isArray(data) ? data[0] : data;
      setLink(row ?? null);
      setLoading(false);
    })();
  }, [code]);

  const submit = async () => {
    setError('');
    if (trap) { setError('Không gửi được hồ sơ. Vui lòng thử lại.'); return; }
    if ((Date.now() - openedAt.current) / 1000 < MIN_SECONDS_ON_FORM) {
      setError('Vui lòng kiểm tra lại thông tin rồi gửi.');
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('submit_onboarding_profile', { p_code: code, p_data: form });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setSent(true);
  };

  if (loading) return <Shell><p className="py-16 text-center text-sm text-slate-400">Đang tải…</p></Shell>;

  if (!link || !link.is_open) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <TriangleAlert className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-3 text-lg font-bold text-slate-800">
            {link ? 'Đường dẫn đã đóng' : 'Không tìm thấy đường dẫn'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Vui lòng liên hệ bộ phận nhân sự để nhận đường dẫn mới.</p>
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
            Bộ phận nhân sự sẽ kiểm tra và duyệt hồ sơ. Sau khi duyệt, tài khoản đăng nhập sẽ được gửi cho bạn.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-5 py-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Khai báo hồ sơ nhân viên</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{link.label}</h1>
          <p className="mt-1 text-sm text-slate-500">Điền chính xác thông tin bên dưới. Các ô có dấu * là bắt buộc.</p>
        </div>

        <Section title="Thông tin cá nhân">
          <Input label="Họ và tên *" value={form.full_name} onChange={set('full_name')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Email *" type="email" value={form.email} onChange={set('email')} />
            <Input label="Số điện thoại" inputMode="tel" value={form.phone} onChange={set('phone')} />
            <Input label="Ngày sinh" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
            <Select label="Giới tính" value={form.gender} onChange={set('gender')}>
              <option value="">—</option>
              <option value="MALE">Nam</option>
              <option value="FEMALE">Nữ</option>
              <option value="OTHER">Khác</option>
            </Select>
            <Input label="Số CCCD" value={form.id_number} onChange={set('id_number')} />
            <Input label="Mã số thuế" value={form.tax_code} onChange={set('tax_code')} />
          </div>
        </Section>

        <Section title="Địa chỉ">
          <Input label="Quê quán" value={form.hometown} onChange={set('hometown')} />
          <Input label="Địa chỉ thường trú" value={form.permanent_address} onChange={set('permanent_address')} />
          <Input label="Địa chỉ hiện tại" value={form.current_address} onChange={set('current_address')} />
        </Section>

        <Section title="Học vấn">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Trình độ" value={form.education_level} onChange={set('education_level')}>
              <option value="">—</option>
              <option value="HIGH_SCHOOL">Trung học phổ thông</option>
              <option value="VOCATIONAL">Trung cấp / nghề</option>
              <option value="COLLEGE">Cao đẳng</option>
              <option value="UNIVERSITY">Đại học</option>
              <option value="POSTGRADUATE">Sau đại học</option>
              <option value="OTHER">Khác</option>
            </Select>
            <Input label="Năm tốt nghiệp" inputMode="numeric" value={form.graduation_year} onChange={set('graduation_year')} />
            <Input label="Trường" value={form.school_name} onChange={set('school_name')} />
            <Input label="Chuyên ngành" value={form.major} onChange={set('major')} />
          </div>
        </Section>

        <Section title="Ngân hàng & liên hệ khẩn cấp">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Ngân hàng" value={form.bank_name} onChange={set('bank_name')} />
            <Input label="Số tài khoản" inputMode="numeric" value={form.bank_account} onChange={set('bank_account')} />
          </div>
          <Input label="Người liên hệ khẩn cấp (tên, quan hệ, SĐT)" value={form.emergency_contact} onChange={set('emergency_contact')} />
          <Textarea label="Ghi chú thêm" value={form.note} onChange={set('note')} />
        </Section>

        <div className="absolute left-[-9999px]" aria-hidden="true">
          <label htmlFor="company-website">Để trống ô này</label>
          <input id="company-website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </div>

        {error && (
          <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            {error}
          </p>
        )}

        <Button theme="admin" className="w-full" onClick={() => void submit()} disabled={busy}>
          <Send className="h-4 w-4" /> {busy ? 'Đang gửi…' : 'Gửi hồ sơ'}
        </Button>
        <p className="text-center text-xs leading-relaxed text-slate-400">
          Bằng việc gửi hồ sơ, bạn đồng ý để {APP_NAME} lưu trữ và xử lý thông tin trên cho mục đích quản lý nhân sự.
        </p>
      </div>
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-1 text-sm font-bold text-slate-700">{title}</legend>
      {children}
    </fieldset>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="relative mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white px-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
