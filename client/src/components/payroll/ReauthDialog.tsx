// ============================================================================
// Ký bằng xác thực lại — dùng cho BGĐ ký duyệt (BR-PAY-010/012) và cho nhân
// viên mở chi tiết phiếu lương (FR06.04.05).
// ----------------------------------------------------------------------------
// Đăng nhập lại bằng mật khẩu ngay trước thao tác; database chỉ nhận thao tác
// khi JWT có mốc xác thực trong vài phút gần nhất. Ô mật khẩu khai
// `current-password` để trên điện thoại trình quản lý mật khẩu của hệ điều
// hành điền được bằng vân tay / FaceID.
// ============================================================================

import { useEffect, useState } from 'react';
import { Fingerprint, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { PasswordField } from '@/components/ui/PasswordField';
import { useAuth } from '@/contexts/AuthContext';
import { reauthenticateWithPassword } from '@/lib/payrollSecurity';

interface ReauthDialogProps {
  open: boolean;
  title: string;
  /** Nói rõ người dùng đang ký cho việc gì. */
  description: React.ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger' | 'success';
  /** Có ô ghi chú / lý do không, và có bắt buộc không (từ chối phải có lý do). */
  note?: { label: string; required: boolean; placeholder?: string };
  onClose: () => void;
  /** Chạy SAU khi xác thực lại thành công. Trả về thông báo lỗi nếu thao tác hỏng. */
  onConfirmed: (note: string) => Promise<string | null>;
}

export function ReauthDialog({
  open, title, description, confirmLabel, tone = 'primary', note, onClose, onConfirmed,
}: ReauthDialogProps) {
  const { profile } = useAuth();
  const [password, setPassword] = useState('');
  const [noteText, setNoteText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setNoteText('');
    setError(null);
  }, [open]);

  const noteMissing = !!note?.required && noteText.trim().length < 3;

  const submit = async () => {
    if (!profile) return;
    if (noteMissing) {
      setError(`${note?.label ?? 'Lý do'} là bắt buộc (ít nhất 3 ký tự).`);
      return;
    }
    setBusy(true);
    setError(null);
    const authError = await reauthenticateWithPassword(profile.email, password);
    if (authError) {
      setBusy(false);
      setError(authError);
      return;
    }
    const actionError = await onConfirmed(noteText.trim());
    setBusy(false);
    if (actionError) {
      setError(actionError);
      return;
    }
    onClose();
  };

  return (
    <Modal square open={open} onClose={busy ? () => undefined : onClose} title={title} size="md">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="flex items-start gap-3 rounded-none border border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-600" />
          <div className="text-sm leading-relaxed text-indigo-900">{description}</div>
        </div>

        {note && (
          <Textarea className="!rounded-none"
            label={note.label}
            required={note.required}
            rows={3}
            placeholder={note.placeholder}
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            error={error && noteMissing ? error : undefined}
          />
        )}

        <div>
          <PasswordField
            label="Mật khẩu đăng nhập của bạn"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            hasError={!!error && !noteMissing}
          />
          <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
            <Fingerprint className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            Trên điện thoại có thể điền bằng vân tay / FaceID qua trình quản lý mật khẩu của máy.
          </p>
        </div>

        {error && !noteMissing && (
          <p role="alert" className="flex items-start gap-2 rounded-none bg-red-50 px-3 py-2 text-sm text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button>
          <Button type="submit" variant={tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'primary'}
            disabled={busy || !password}>
            {busy ? 'Đang xác thực…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
