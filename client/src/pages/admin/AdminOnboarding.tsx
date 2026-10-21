import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Plus, UserCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import type { Profile } from '@/types';

interface OnboardingLink {
  id: string; code: string; label: string; is_active: boolean; expires_at: string | null; created_at: string;
}

interface Submission {
  id: string; link_id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED';
  full_name: string; email: string; phone: string | null; date_of_birth: string | null; gender: string | null;
  id_number: string | null; tax_code: string | null; bank_name: string | null; bank_account: string | null;
  hometown: string | null; permanent_address: string | null; current_address: string | null;
  education_level: Profile['education_level']; school_name: string | null; major: string | null;
  graduation_year: number | null; emergency_contact: string | null; note: string | null;
  review_note: string | null; submitted_at: string;
}

const STATUS_LABEL = { PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối' } as const;
const STATUS_STYLE = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-slate-200 text-slate-600',
} as const;
const GENDER = { MALE: 'Nam', FEMALE: 'Nữ', OTHER: 'Khác' } as const;

const newCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
};
const linkUrl = (code: string) => `${window.location.origin}/khai-bao/${code}`;

export function AdminOnboarding() {
  const { toast } = useToast();
  const { createUser, updateUser } = useAuth();
  const [links, setLinks] = useState<OnboardingLink[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [filter, setFilter] = useState<Submission['status'] | 'ALL'>('PENDING');
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ name: string; email: string; tempPassword: string } | null>(null);

  const load = useCallback(async () => {
    const [l, s] = await Promise.all([
      supabase.from('onboarding_links').select('*').order('created_at', { ascending: false }),
      supabase.from('onboarding_submissions').select('*').order('submitted_at', { ascending: false }),
    ]);
    if (l.error || s.error) { toast('Không tải được dữ liệu: ' + describeDbError((l.error ?? s.error)!), 'error'); return; }
    setLinks((l.data ?? []) as OnboardingLink[]);
    setSubs((s.data ?? []) as Submission[]);
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const createLink = async () => {
    if (label.trim().length < 2) { toast('Nhập tên đợt/nhóm cho đường dẫn.', 'error'); return; }
    const { error } = await supabase.from('onboarding_links').insert({ code: newCode(), label: label.trim() });
    if (error) { toast('Tạo đường dẫn thất bại: ' + describeDbError(error), 'error'); return; }
    setLabel('');
    await load();
  };

  const toggleLink = async (item: OnboardingLink) => {
    const { error } = await supabase.from('onboarding_links').update({ is_active: !item.is_active }).eq('id', item.id);
    if (error) toast(describeDbError(error), 'error'); else await load();
  };

  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(linkUrl(code)); toast('Đã sao chép đường dẫn.', 'success'); }
    catch { toast('Không sao chép tự động được: ' + linkUrl(code), 'error'); }
  };

  const approve = async (s: Submission) => {
    setBusy(true);
    const created = await createUser({ name: s.full_name, identifier: s.email, role: 'staff', access_role_code: 'staff' });
    if (created.error || !created.id) {
      setBusy(false);
      toast('Không cấp được tài khoản: ' + (created.error ?? 'không rõ lỗi'), 'error');
      return;
    }
    const detail = await updateUser(created.id, {
      phone: s.phone, hometown: s.hometown, permanent_address: s.permanent_address,
      current_address: s.current_address, education_level: s.education_level,
      school_name: s.school_name, major: s.major, graduation_year: s.graduation_year,
    });
    const { data: me } = await supabase.auth.getUser();
    const { error } = await supabase.from('onboarding_submissions').update({
      status: 'APPROVED', profile_id: created.id, reviewed_by: me.user?.id ?? null, reviewed_at: new Date().toISOString(),
    }).eq('id', s.id);
    setBusy(false);
    if (error) toast('Đã tạo tài khoản nhưng chưa ghi được trạng thái duyệt: ' + describeDbError(error), 'error');
    if (detail.error) toast('Đã tạo tài khoản, nhưng chưa ghi được thông tin hồ sơ: ' + detail.error, 'error');
    setSelected(null);
    setIssued({ name: s.full_name, email: created.email ?? s.email, tempPassword: created.tempPassword ?? '' });
    await load();
  };

  const reject = async (s: Submission) => {
    const reason = window.prompt('Lý do từ chối (không bắt buộc):') ?? null;
    const { data: me } = await supabase.auth.getUser();
    const { error } = await supabase.from('onboarding_submissions').update({
      status: 'REJECTED', review_note: reason, reviewed_by: me.user?.id ?? null, reviewed_at: new Date().toISOString(),
    }).eq('id', s.id);
    if (error) { toast(describeDbError(error), 'error'); return; }
    setSelected(null);
    await load();
  };

  const shown = subs.filter((s) => filter === 'ALL' || s.status === filter);
  const pending = subs.filter((s) => s.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Khai báo hồ sơ qua đường dẫn</h1>
        <p className="mt-1 text-sm text-slate-500">
          Gửi đường dẫn cho nhân viên mới tự khai báo. Hồ sơ về đây chờ duyệt; duyệt xong hệ thống tự cấp tài khoản và mật khẩu tạm.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700"><Link2 className="h-4 w-4" /> Đường dẫn khai báo</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1"><Input label="Tên đợt / nhóm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VD: Nhân viên mới tháng 11" /></div>
          <Button theme="admin" onClick={() => void createLink()}><Plus className="h-4 w-4" /> Tạo đường dẫn</Button>
        </div>
        <ul className="divide-y divide-slate-100">
          {links.length === 0 && <li className="py-3 text-sm text-slate-400">Chưa có đường dẫn nào.</li>}
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-medium text-slate-800">{l.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${l.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                {l.is_active ? 'Đang mở' : 'Đã đóng'}
              </span>
              <code className="min-w-0 flex-1 truncate text-xs text-slate-500">{linkUrl(l.code)}</code>
              <Button variant="secondary" size="sm" onClick={() => void copy(l.code)}><Copy className="h-3.5 w-3.5" /> Sao chép</Button>
              <Button variant="secondary" size="sm" onClick={() => void toggleLink(l)}>{l.is_active ? 'Đóng' : 'Mở lại'}</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <UserCheck className="h-4 w-4" /> Hồ sơ đã khai báo {pending > 0 && <span className="rounded-full bg-amber-500 px-2 text-xs text-white">{pending} chờ duyệt</span>}
          </h2>
          <div className="flex gap-1">
            {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1 text-xs font-medium ${filter === f ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {f === 'ALL' ? 'Tất cả' : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <ul className="divide-y divide-slate-100">
          {shown.length === 0 && <li className="py-3 text-sm text-slate-400">Không có hồ sơ.</li>}
          {shown.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{s.full_name}</p>
                <p className="truncate text-xs text-slate-500">{s.email} · {new Date(s.submitted_at).toLocaleString('vi-VN')}</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[s.status]}`}>{STATUS_LABEL[s.status]}</span>
              <Button variant="secondary" size="sm" onClick={() => setSelected(s)}>Xem</Button>
            </li>
          ))}
        </ul>
      </section>

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Hồ sơ khai báo" size="lg">
        {selected && (
          <div className="space-y-4">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Row k="Họ tên" v={selected.full_name} />
              <Row k="Email" v={selected.email} />
              <Row k="Điện thoại" v={selected.phone} />
              <Row k="Ngày sinh" v={selected.date_of_birth} />
              <Row k="Giới tính" v={selected.gender ? GENDER[selected.gender as keyof typeof GENDER] : null} />
              <Row k="CCCD" v={selected.id_number} />
              <Row k="Mã số thuế" v={selected.tax_code} />
              <Row k="Ngân hàng" v={[selected.bank_name, selected.bank_account].filter(Boolean).join(' · ') || null} />
              <Row k="Quê quán" v={selected.hometown} />
              <Row k="Thường trú" v={selected.permanent_address} />
              <Row k="Hiện tại" v={selected.current_address} />
              <Row k="Học vấn" v={[selected.education_level, selected.school_name, selected.major, selected.graduation_year].filter(Boolean).join(' · ') || null} />
              <Row k="Liên hệ khẩn cấp" v={selected.emergency_contact} />
              <Row k="Ghi chú" v={selected.note} />
              {selected.review_note && <Row k="Lý do từ chối" v={selected.review_note} />}
            </dl>
            {selected.status === 'PENDING' && (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => void reject(selected)} disabled={busy}><X className="h-4 w-4" /> Từ chối</Button>
                <Button theme="admin" onClick={() => void approve(selected)} disabled={busy}>
                  <Check className="h-4 w-4" /> {busy ? 'Đang cấp tài khoản…' : 'Duyệt & cấp tài khoản'}
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!issued} onClose={() => setIssued(null)} title="Đã cấp tài khoản" size="sm">
        {issued && (
          <div className="space-y-3 text-sm">
            <p>Tài khoản của <strong>{issued.name}</strong> đã được tạo. Mật khẩu tạm chỉ hiển thị một lần, hãy gửi cho nhân viên; họ sẽ phải đổi mật khẩu khi đăng nhập lần đầu.</p>
            <div className="rounded-xl bg-slate-50 p-3 font-mono text-xs">
              <p>Đăng nhập: {issued.email}</p>
              <p>Mật khẩu tạm: {issued.tempPassword}</p>
            </div>
            <Button theme="admin" className="w-full" onClick={() => {
              void navigator.clipboard?.writeText(`Đăng nhập: ${issued.email}\nMật khẩu tạm: ${issued.tempPassword}`);
              toast('Đã sao chép.', 'success');
            }}><Copy className="h-4 w-4" /> Sao chép thông tin</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{k}</dt>
      <dd className="text-slate-800">{v || '—'}</dd>
    </div>
  );
}
